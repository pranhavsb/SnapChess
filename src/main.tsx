import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { ensureAnonymousUser } from "./lib/supabase";

void ensureAnonymousUser();

const AboutPage = lazy(() => import("./about/AboutPage").then((m) => ({ default: m.AboutPage })));

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

const isAbout = window.location.pathname.replace(/\/+$/, "") === "/about";

createRoot(root).render(
  <StrictMode>
    {isAbout ? (
      <Suspense fallback={null}>
        <AboutPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
