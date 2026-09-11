import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ConverterCloudPanel from "./cloud/ConverterCloudPanel";
import CloudLibraryPage from "./library/CloudLibraryPage";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const cloudView = params.get("view") === "library" || Boolean(params.get("s"));

function Root() {
  if (cloudView) return <CloudLibraryPage />;
  return (
    <>
      <App />
      <ConverterCloudPanel />
      <a className="cloud-library-launcher" href={`${window.location.pathname}?view=library`}>
        CLOUD LIBRARY
        <span>公开曲谱 · Toy 云存档</span>
      </a>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
