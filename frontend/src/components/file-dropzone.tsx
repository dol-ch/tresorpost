import { useRef, useState } from "react";
import { Upload } from "lucide-react";

import { cn } from "@/lib/utils";

export function FileDropzone({
  accept,
  label,
  file,
  onFile,
}: {
  accept?: string;
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function take(list: FileList | null) {
    onFile(list?.[0] ?? null);
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        take(e.dataTransfer.files);
      }}
      className={cn(
        "flex min-h-36 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
        drag
          ? "border-ring bg-muted/60"
          : "border-input bg-muted/20 hover:bg-muted/40",
      )}
    >
      <Upload className="size-5 text-muted-foreground" />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">
        {file ? `${file.name}` : "Click or drop a file here"}
      </span>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        onChange={(e) => take(e.target.files)}
      />
    </button>
  );
}
