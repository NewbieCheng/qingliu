import { useEffect, useState } from "react";
import { readStorage, writeStorage } from "@/shared/lib/storage.js";

export function useStoredFlag(key) {
  const [value, setValue] = useState(() => readStorage(key) === "1");
  useEffect(() => {
    writeStorage(key, value ? "1" : "0");
  }, [key, value]);
  return [value, setValue];
}
