import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";

function PasswordInput({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onEnter?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        className="w-full rounded border p-2 pr-10"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setStep("request");
    setSentTo("");
    setCode("");
    setNext("");
    setConfirm("");
    setError("");
  };

  const sendCode = async () => {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/change-password/request", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send the email.");
        return;
      }
      setSentTo(data.sentTo ?? "");
      setStep("confirm");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    if (!code.trim() || !next || !confirm)
      return setError("Fill in all fields.");
    if (next.length < 8)
      return setError("New password must be at least 8 characters.");
    if (next !== confirm) return setError("New passwords do not match.");
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/change-password/confirm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to change password.");
        return;
      }
      toast.success("Password changed");
      close();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
      >
        <KeyRound className="h-4 w-4" /> Change password
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-6 text-black shadow-xl">
            <h2 className="text-lg font-bold">Change password</h2>

            {step === "request" ? (
              <>
                <p className="text-sm text-gray-600">
                  We will email a 6-digit verification code to the admin email.
                </p>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={close} className="rounded px-3 py-2 text-sm">
                    Cancel
                  </button>
                  <button
                    onClick={sendCode}
                    disabled={busy}
                    className="rounded bg-blue-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {busy ? "Sending..." : "Send code"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  A 6-digit verification code will be sent to the
                  administrator's email address
                </p>
                <input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full rounded border p-2 tracking-widest"
                />
                <PasswordInput
                  placeholder="New password (min. 8 characters)"
                  value={next}
                  onChange={setNext}
                />
                <PasswordInput
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={setConfirm}
                  onEnter={changePassword}
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex items-center justify-between">
                  <button
                    onClick={sendCode}
                    disabled={busy}
                    className="text-xs text-blue-700 underline disabled:opacity-50"
                  >
                    Resend code
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={close}
                      className="rounded px-3 py-2 text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={changePassword}
                      disabled={busy}
                      className="rounded bg-blue-800 px-4 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {busy ? "Saving..." : "Change"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
