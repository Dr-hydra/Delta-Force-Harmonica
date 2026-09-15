"""Convert upstream NumPy weights to little-endian TF.js HWIO tensors.

Usage: python scripts/convert-symbolic-weights.py path/to/upstream-checkout
Uses git objects to avoid Windows line-ending conversion of protocol-0 pickle.
Only NumPy array constructors are accepted by the unpickler.
"""
import io
import json
import pickle
from pathlib import Path
import subprocess
import sys
import numpy as np


class WeightsOnly(pickle.Unpickler):
    def find_class(self, module, name):
        allowed = {
            ('numpy.core.multiarray', '_reconstruct'): np._core.multiarray._reconstruct,
            ('numpy', 'ndarray'): np.ndarray,
            ('numpy', 'dtype'): np.dtype,
        }
        if (module, name) not in allowed:
            raise ValueError(f'Unsupported pickle object: {module}.{name}')
        return allowed[module, name]


repo = sys.argv[1]
raw = subprocess.check_output(['git', '-C', repo, 'show', 'HEAD:nn_kernels_pop.pkl'])
weights = WeightsOnly(io.BytesIO(raw), encoding='latin1').load()
assert [w.shape for w in weights[:2]] == [(21, 1, 32, 16), (21, 21, 32, 16)]
target = Path('public/melody')
target.mkdir(parents=True, exist_ok=True)
# Lasagne Conv2D defaults to mathematical convolution (flip_filters=True).
# TF.js uses cross-correlation; flip both spatial axes before transposing.
converted = [w[:, :, ::-1, ::-1].transpose(2, 3, 1, 0).astype('<f4') for w in weights[:2]]
(target / 'symbolic-pop.data').write_bytes(b''.join(w.tobytes() for w in converted))
(target / 'symbolic-pop.json').write_text(json.dumps({
    'shapes': [list(w.shape) for w in converted],
    'switch': bool(weights[-1]),
    'source': 'https://github.com/LIMUNIMI/Symbolic-Melody-Identification',
    'revision': subprocess.check_output(['git', '-C', repo, 'rev-parse', 'HEAD']).decode().strip(),
    'model': 'nn_kernels_pop.pkl',
}), encoding='utf-8')
print('Converted pretrained pop model; no training or random weights used.')
