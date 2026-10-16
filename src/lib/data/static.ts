// The static adapter's dataset: the bundled seed, exactly the objects the
// demo has always shown, dry-run files included. Server and tests only; the
// browser gets STATIC_BASE (staticBase.ts) and each page's files through WithFiles.

import { RAW } from "../seed/files";
import { STATIC_BASE } from "./staticBase";
import type { Dataset } from "./types";

export const STATIC_DATASET: Dataset = { ...STATIC_BASE, files: RAW };
