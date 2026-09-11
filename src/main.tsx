import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ConverterCloudPanel from "./cloud/ConverterCloudPanel";
import CloudLibraryPage from "./library/CloudLibraryPage";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const cloudView = params.get("view") === "library" || Boolean(params.get("s"));

function libraryHref() {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("view", "library");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

/**
 * App.tsx still owns the legacy converter rail. Until that rail is split into a
 * shared navigation component, promote its existing second item into the live
 * score-library entry here so desktop and mobile use the same canonical button.
 */
function ConverterLibraryNavigation() {
  useEffect(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".app-shell .side-rail nav > button"));
    const cloudButton = buttons.find((button) => button.textContent?.includes("云端乐谱"));
    if (!cloudButton) return;

    const label = cloudButton.querySelector("span");
    const badge = cloudButton.querySelector("em");
    cloudButton.disabled = false;
    cloudButton.removeAttribute("disabled");
    cloudButton.setAttribute("aria-label", "打开曲谱库");
    cloudButton.title = "打开公开曲谱、我的云存档与我的发布";
    cloudButton.classList.add("nav-available");
    if (label) label.textContent = "曲谱库";
    if (badge) badge.textContent = "OPEN";

    const open = () => window.location.assign(libraryHref());
    cloudButton.addEventListener("click", open);
    return () => cloudButton.removeEventListener("click", open);
  }, []);

  return null;
}

function Root() {
  if (cloudView) return <CloudLibraryPage />;
  return (
    <>
      <App />
      <ConverterLibraryNavigation />
      <ConverterCloudPanel />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
