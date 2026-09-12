import { useCallback, useState } from "react";

const RAIL_KEY = "dfh-rail-collapsed";

/**
 * A phone held in landscape has roughly 390px of height to work with, so the
 * wide rail is a bad default there. Desktop keeps whatever was chosen last.
 */
function rememberedCollapsed() {
  const stored = localStorage.getItem(RAIL_KEY);
  if (stored !== null) return stored === "1";
  return window.matchMedia("(orientation: landscape) and (max-height: 600px) and (max-width: 1100px)").matches;
}

export function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState(rememberedCollapsed);

  // Only an explicit toggle is remembered. Writing on mount would pin the first
  // visit's orientation and the landscape default would never apply again.
  const toggle = useCallback(() => setCollapsed((value) => {
    localStorage.setItem(RAIL_KEY, value ? "0" : "1");
    return !value;
  }), []);
  return { collapsed, toggle };
}

export function RailToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      className="rail-toggle"
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? "展开边栏" : "收起边栏"}
      title={collapsed ? "展开边栏" : "收起边栏"}
      onClick={onToggle}
    >
      <i aria-hidden="true">{collapsed ? "▶" : "◀"}</i>
      <span>收起边栏</span>
    </button>
  );
}
