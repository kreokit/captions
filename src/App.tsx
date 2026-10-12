import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadProject } from "./lib/project";
import { Editor } from "./components/Editor";
import { Home } from "./components/Home";
import { useEditor } from "./store/editor";
import { ToastRegion } from "./ui";
import "./App.css";

function App() {
  const hasProject = useEditor((s) => s.project !== null);

  // Development aid: KREOKIT_DEV_OPEN=/path/to/project.kreocap opens it at startup.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Not added to the recent list, so test projects don't clutter it.
    invoke<string | null>("dev_startup_project").then(async (path) => {
      if (path) useEditor.getState().open(await loadProject(path), path);
    });
  }, []);

  return (
    <>
      {hasProject ? <Editor /> : <Home />}
      <ToastRegion />
    </>
  );
}

export default App;
