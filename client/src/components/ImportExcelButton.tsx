import { useRef } from "react";
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

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

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
        msg = "Erything already exists";
      }

      if (data.skippedAvailability?.length) {
        msg += ` (missing availability: ${data.skippedAvailability.join(", ")})`;
      }
      if (data.unknownDays?.length) {
        msg += ` (unknown days: ${data.unknownDays.join(", ")})`;
      }

      if (parts.length > 0) {
        toast.success(msg);
      } else {
        toast(msg);
      }
      onDone();
    }

    e.target.value = "";
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
    </>
  );
}
