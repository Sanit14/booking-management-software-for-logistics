import { useEffect, useState } from 'react';

/** `value`, but only once it has stayed the same for `ms`: a fast typist asks the keeper once. */
export function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
