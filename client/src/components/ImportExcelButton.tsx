import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { authFetch } from "../lib/authFetch";

export function ImportExcelButton({
  endpoint,
  onDone,
}: {
  endpoint: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    setImporting(true);
    try {
      const res = await fetch(endpoint, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Import failed");
      } else {
        const isProfessorImport = !data.hasOwnProperty("curriculumInserted");
        const parts: string[] = [];
        if (data.inserted) {
          parts.push(
            isProfessorImport
              ? `${data.inserted} professor${data.inserted !== 1 ? "s" : ""}`
              : `${data.inserted} course${data.inserted !== 1 ? "s" : ""}`,
          );
        }
        if (data.curriculumInserted) {
          parts.push(
            `${data.curriculumInserted} placement${data.curriculumInserted !== 1 ? "s" : ""}`,
          );
        }

        let msg: string;
        if (parts.length > 0) {
          msg = `Imported ${parts.join(", ")}`;
        } else if (isProfessorImport) {
          msg = "No new professors added";
        } else {
          msg = "Everything already exists";
        }

        if (data.skippedAvailability?.length) {
          msg += ` (missing availability: ${data.skippedAvailability.join(", ")})`;
        }
        if (data.unmatchedDepartments?.length) {
          msg += ` (unknown department, set to Unassigned: ${data.unmatchedDepartments.join(", ")})`;
        }

        if (parts.length > 0) {
          toast.success(msg);
        } else {
          toast(msg);
        }
        onDone();
      }
    } catch (err) {
      console.error("Import failed", err);
      toast.error("Import failed. Check your connection and try again.");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={handleFile}
      />
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        Import Excel
      </Button>
      {importing &&
        createPortal(
          <div
            role="status"
            aria-busy="true"
            className="fixed inset-y-0 right-0 left-64 z-[60] flex cursor-wait items-center justify-center bg-gray-200/60"
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-3 shadow-md">
              <Loader2 className="h-5 w-5 animate-spin text-gray-700" />
              <span className="text-sm text-gray-700">Importing Excel...</span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
