import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Dialog } from "../ui";

interface CpuSupport {
  supported: boolean;
  missing: string[];
}

/**
 * Release builds need AVX2, FMA and F16C for transcription (src-tauri/src/cpu.rs). On an
 * older CPU, explain that once at startup instead of crashing later.
 */
export function CpuCheck() {
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    invoke<CpuSupport>("cpu_support").then(
      (s) => !s.supported && setMissing(s.missing),
      () => {},
    );
  }, []);

  if (!missing) return null;
  return (
    <Dialog
      title="This CPU isn't supported yet"
      onClose={() => setMissing(null)}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={() => invoke("quit_app")}>
            Quit
          </Button>
          <Button variant="primary" onClick={() => setMissing(null)}>
            Continue without transcription
          </Button>
        </>
      }
    >
      <p className="cpu-check-text">
        Transcription needs a processor with {missing.join(", ")} — most Intel CPUs from 2013 and AMD CPUs
        from 2015 on. This computer's processor doesn't have {missing.length === 1 ? "it" : "them"}, so
        KreoKit Captions can't make captions here yet.
      </p>
      <p className="cpu-check-text">You can still open, edit and export existing projects.</p>
    </Dialog>
  );
}
