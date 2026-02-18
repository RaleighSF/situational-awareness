import { useState, useCallback, type ReactNode, type FormEvent } from "react";
import nttDataLogo from "@assets/ntt-data-logo.png";

const AUTH_KEY = "vss_auth";
const PASS_HASH = "a3f1c2"; // lightweight check — not a security boundary

function hashPass(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 6);
}

// Pre-compute the hash once so the plain-text password only lives in the build
const EXPECTED = hashPass("PhysicalAI#1");

function isAuthed(): boolean {
  try {
    return sessionStorage.getItem(AUTH_KEY) === EXPECTED;
  } catch {
    return false;
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(isAuthed);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (hashPass(password) === EXPECTED) {
        sessionStorage.setItem(AUTH_KEY, EXPECTED);
        setAuthed(true);
      } else {
        setError(true);
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
      }
    },
    [password],
  );

  if (authed) return <>{children}</>;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      {/* subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(118,185,0,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(118,185,0,.4) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div
        className={`relative z-10 w-full max-w-sm mx-4 ${shaking ? "animate-shake" : ""}`}
      >
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-8 shadow-2xl">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <img
              src={nttDataLogo}
              alt="NTT DATA"
              className="h-8 opacity-90"
            />
            <div className="h-px w-12 bg-[#76B900]/40" />
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Video Search &amp; Summarization
            </h1>
            <p className="text-xs text-muted-foreground text-center max-w-[260px]">
              Enterprise vision analytics demo. Enter the access code to continue.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="space-y-2">
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                placeholder="Access code"
                autoFocus
                className={`w-full rounded-lg border bg-muted/40 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-[#76B900]/60 focus:ring-1 focus:ring-[#76B900]/30 ${
                  error
                    ? "border-red-500/60 focus:border-red-500/60 focus:ring-red-500/30"
                    : "border-border/60"
                }`}
              />
              {error && (
                <p className="text-xs text-red-400 pl-1">
                  Invalid access code. Please try again.
                </p>
              )}
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-[#76B900] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#6aa600] active:bg-[#5e9400] disabled:opacity-50"
              disabled={!password.trim()}
            >
              Enter Demo
            </button>
          </form>

          {/* Footer */}
          <p className="text-[10px] text-muted-foreground/50 tracking-wide uppercase">
            Powered by NVIDIA Cosmos &amp; Gemini
          </p>
        </div>
      </div>

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.5s ease-in-out; }
      `}</style>
    </div>
  );
}
