import { useState } from "react";
import { ModalFrame } from "../../components/Modal";
import { ui } from "../../store/ui";

// In-app replacement for window.prompt — Electron doesn't support prompt(), so
// every "how many? / which kind?" question goes through this. Resolves the
// entered string, or null on cancel / Esc / ✕.
export function askText(title: string, def = ""): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    ui().openModal({
      compact: true,
      onClose: () => done(null),
      body: (
        <AskText
          title={title}
          def={def}
          onOk={(v) => {
            done(v);
            ui().closeModal();
          }}
        />
      ),
    });
  });
}

function AskText({ title, def, onOk }: { title: string; def: string; onOk: (v: string) => void }) {
  const [v, setV] = useState(def);
  return (
    <ModalFrame title={title}>
      <div className="askbox">
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === "Enter" && onOk(v)}
        />
        <div className="askrow">
          <button onClick={() => onOk(v)}>OK</button>
          <button onClick={ui().closeModal}>Cancel</button>
        </div>
      </div>
    </ModalFrame>
  );
}
