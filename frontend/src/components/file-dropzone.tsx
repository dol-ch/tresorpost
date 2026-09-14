import { useRef, useState } from "react";
import { Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { humanSize } from "@/options";

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
        "flex min-h-36 w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed px-5 py-10 text-center transition-colors",
        drag ? "border-primary bg-border" : "border-border bg-muted hover:bg-border",
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]">
        <Upload className="size-5 text-primary" strokeWidth={1.8} />
      </div>
      <span className="max-w-full truncate text-[14.5px] font-medium text-muted-foreground">
        {file ? `${file.name} — ${humanSize(file.size)}` : label}
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
