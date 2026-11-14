import React, { useEffect, useState } from "react";
import Landing from "./pages/Landing.jsx";
import Review from "./pages/Review.jsx";
import Approvals from "./pages/Approvals.jsx";
import Profile from "./pages/Profile.jsx";
import Insights from "./pages/Insights.jsx";
import Responsible from "./pages/Responsible.jsx";
import Icon from "./components/Icon.jsx";
import { useStore } from "./store.jsx";
import { USERS } from "./engine/seed.js";
import { API_CONFIGURED } from "./api.js";
import { navigate } from "./util.js";

const NAV = [
  { path: "/review", label: "Review", icon: "search" },
  { path: "/approvals", label: "Approvals", icon: "check" },
  { path: "/profile", label: "Brand Profile", icon: "book" },
  { path: "/insights", label: "Insights", icon: "chart" },
];

function useRoute() {
  const get = () => (window.location.hash.replace(/^#/, "") || "/").split("?")[0];
  const [route, setRoute] = useState(get());
  useEffect(() => {
    const on = () => { setRoute(get()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function Shell({ route, children }) {
  const { state, dispatch } = useStore();
  const pending = state.submissions.filter((s) => s.status === "in_review").length;
  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("/")} aria-label="Home">
          <span className="logo"><Icon name="shield" size={18} /></span>
          <span><b>CodeBlooded</b><small>Brand Governance</small></span>
        </button>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={route === n.path ? "nav-a on" : "nav-a"}>
              <Icon name={n.icon} size={16} /> {n.label}
              {n.path === "/approvals" && pending > 0 && <span className="badge">{pending}</span>}
            </a>
          ))}
        </nav>
        <div className="top-right">
          <span className={API_CONFIGURED ? "pill pill-ok" : "pill pill-muted"} title={API_CONFIGURED ? "Using the Flask API, falling back to local rules if it is unreachable" : "Running on the built-in rule engine"}>
            {API_CONFIGURED ? "API connected" : "Local rules engine"}
          </span>
          <label className="role-pick">
            <span className="sr">Acting as</span>
            <select value={state.role} onChange={(e) => dispatch({ type: "role", role: e.target.value })} aria-label="Acting as">
              <option value="creator">Creator · {USERS.creator.name}</option>
              <option value="reviewer">Reviewer · {USERS.reviewer.name}</option>
              <option value="manager">Brand Manager · {USERS.manager.name}</option>
            </select>
          </label>
        </div>
      </header>
      <main className="main">{children}</main>
      <footer className="foot">
        <span>CodeNova 2026 · Team CodeBlooded · Prototype with sample, non-confidential brand data · <a href="#/responsible">Responsible AI</a></span>
        <button className="link-btn" onClick={() => { if (window.confirm("Reset all demo data?")) dispatch({ type: "reset" }); }}>Reset demo data</button>
      </footer>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  if (route === "/" || route === "") return <Landing />;
  const page = { "/review": <Review />, "/approvals": <Approvals />, "/profile": <Profile />, "/insights": <Insights />, "/responsible": <Responsible /> }[route];
  return <Shell route={route}>{page || <Review />}</Shell>;
}
