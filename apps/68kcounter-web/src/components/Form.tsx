import {
  type FC,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./Form.css";
import { Asm } from "./icons/Asm";

export interface InputProps {
  onSubmit: (code: string) => void;
}

export const Form: FC<InputProps> = ({ onSubmit }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [code, setCode] = useState("");

  const handleFiles = useCallback(
    (f: FileList | null) => {
      if (f && f[0]) {
        f[0].text().then((code) => {
          setCode(code);
          onSubmit(code);
        });
      }
    },
    [onSubmit],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(code);
  };

  useEffect(() => {
    let dragCounter = 0;
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDragEnter = () => {
      setDragging(true);
      dragCounter++;
    };
    const handleDragLeave = () => {
      if (--dragCounter === 0) setDragging(false);
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setDragging(false);
      if (e.target === ref.current && e.dataTransfer?.files)
        handleFiles(e.dataTransfer.files);
    };
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleFiles]);
  return (
    <form className="Form" onSubmit={handleSubmit}>
      <input type="file" onChange={(e) => handleFiles(e.target.files)} />
      <div className={"Form__dropper" + (dragging ? " isDragging" : "")}>
        <textarea
          className="Form__textarea"
          value={code}
          placeholder="Paste or drop ASM source here"
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="Form__dropOverlay" ref={ref}>
          <Asm size="3em" />
          <div>Drop here</div>
        </div>
      </div>
      <button type="submit" className="Form__submit">
        Analyse
      </button>
    </form>
  );
};
