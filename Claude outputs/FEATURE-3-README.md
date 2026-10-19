# Feature 3: Rollback & Retry | Recuperación Inteligente

## Overview | Resumen

**Smart failure recovery with automatic rollback and intelligent retry logic.**

Cuando una tarea falla durante la ejecución multi-wave, open-SDD ahora:
- 🔍 Analiza la causa raíz del error automáticamente
- 💡 Propone una corrección específica
- ⟳ Reintenta la tarea con el fix aplicado (hasta 3 intentos)
- 🔙 Ejecuta rollback seguro si falla permanentemente
- 💾 Guarda checkpoints después de cada wave

---

## Usage | Uso

### 1. Normal Implementation (sin checkpoints)
```bash
/sdd-impl auth
```
Ejecución normal sin recuperación automática.

### 2. Implementation WITH Checkpointing
```bash
/sdd-impl auth --checkpoint
```
Activa sistema de checkpoints. Si falla:
- Guarda checkpoint después de cada wave completada
- Ofrece opciones de recuperación interactivas
- Permite retry, skip, rollback o quit

### 3. Resume from Checkpoint
```bash
/sdd-impl auth --resume 2
```
Continúa desde wave 2 (después de wave 1 completada).

### 4. Rollback to Specific Wave
```bash
/sdd-impl auth --rollback-to 1
```
Restaura archivo a estado de wave 1, descarta cambios posteriores.

---

## Architecture | Arquitectura

### Core Modules

**failureRecovery.ts (458 LOC)**
- `saveCheckpoint()` — Guarda estado después de cada wave
- `loadCheckpoint()` — Carga checkpoint del disco
- `analyzeError()` — Detecta causa raíz (import, syntax, logic, dependency)
- `rollbackToCheckpoint()` — Restaura archivos al estado guardado
- `getRecoveryOptions()` — Determina opciones disponibles
- `createFixForError()` — Genera corrección sugerida

**rollback-retry.ts (371 LOC)**
- `handleRollbackRetry()` — Punto de entrada principal (CLI handler)
- `handleRollbackRequest()` — Maneja `--rollback-to` flag
- `handleResumeFromCheckpoint()` — Maneja `--resume` flag
- `handleImplementationWithCheckpointing()` — Ejecuta multi-wave con recovery
- Rendering functions — UI para checkpoint info, error analysis, recovery options

### Checkpoint Structure
```json
{
  "feature": "auth",
  "waveNum": 2,
  "timestamp": 1726600000000,
  "fileSnapshots": {
    "src/auth/middleware.ts": "... file contents ...",
    "src/index.ts": "... file contents ..."
  },
  "taskStates": [
    {
      "id": "task-2-1",
      "name": "Generate core files",
      "status": "completed",
      "retryCount": 0,
      "maxRetries": 3
    }
  ],
  "metadata": {
    "specVersion": "1.0",
    "completedTasks": 2,
    "totalTasks": 2
  }
}
```

Guardado en: `.sdd/.checkpoints/{feature}/wave-{N}.json`

---

## Error Analysis & Recovery | Análisis de Errores

### Error Categories
1. **Import Errors** (🔴 Critical)
   - Causa: Missing module, bad import path
   - Fix: `npm install <module>`
   
2. **Syntax Errors** (🔴 Critical)
   - Causa: Invalid TypeScript/JavaScript
   - Fix: Review code syntax compliance
   
3. **Dependency Errors** (🟠 High)
   - Causa: Incompatible or missing dependencies
   - Fix: `npm install && npm run build`
   
4. **Logic Errors** (🟡 Medium)
   - Causa: Null/undefined references, bad logic
   - Fix: Add guards and type assertions

### Retry Strategy
```
Attempt 1: Execute task
  ↓ (fails) → Analyze error
  ↓ → Apply suggested fix
  ↓
Attempt 2: Retry with fix
  ↓ (fails) → Still broken
  ↓ → User choice: Retry again | Skip | Rollback | Quit
  ↓
Attempt 3: Final retry
  ↓ (fails) → Max retries exceeded
  ↓ → Rollback to previous checkpoint or Quit
```

Max retries: **3 per task**

---

## Wave Execution Model | Modelo de Ejecución

```
Wave 1: Parse & Validate
├─ Validate spec
└─ Analyze dependencies
  ↓ (on success) → Save checkpoint 1
  ↓
Wave 2: Code Generation
├─ Generate core files
└─ Generate tests
  ↓ (on success) → Save checkpoint 2
  ↓
Wave 3: Integration
├─ Wire router
└─ Update package.json
  ↓ (on success) → Save checkpoint 3
  ↓
Wave 4: Build & Verify
├─ TypeScript build
└─ Lint checks
  ↓ (on success) → DONE
```

**Si Wave N falla:**
1. Ofrece opciones: Retry | Skip | Rollback | Quit
2. Si Rollback: Restaura a Wave N-1, descarta cambios
3. Si Retry: Aplica fix sugerido, reintenta (hasta 3x)
4. Si Skip: Continúa a Wave N+1 (risky ⚠️)
5. Si Quit: Guarda checkpoint N-1 para resume posterior

---

## UI & Feedback | Interfaz de Usuario

### Checkpoint Info
```
📌 Checkpoint Information
├─ Feature: auth
├─ Wave: 2
├─ Saved: 2026-09-17 19:10:00
├─ Files: 5
└─ Tasks: 2/2 completed
```

### Error Analysis
```
🔴 Error Analysis
Root Cause: Missing import statement
Category: IMPORT
Severity: critical
Confidence: 95%

Affected Files:
  ├─ src/auth/middleware.ts

💡 Suggested Fix:
  npm install @types/express
```

### Recovery Options
```
🔄 Recovery Options:
  [R] Retry (Attempt 2/3)
     Apply suggested fix and retry
  [S] Skip and Continue
     Skip this task and continue (may cause issues)
  [B] Rollback All Changes
     Restore to previous checkpoint
  [Q] Quit and Save State
     Exit and save current checkpoint for later retry
```

### Rollback Progress
```
🔙 Rolling Back Changes
✓ Restored 5/5 files

State saved. Run /sdd-impl to retry from next wave.
```

---

## Implementation Example | Ejemplo de Uso

```bash
$ /sdd-impl auth --checkpoint

🚀 Implementing: auth (Checkpoint Enabled)

📊 Wave 1: Parse & Validate
├─ Tasks: Validate spec, Analyze dependencies
├─ [1/2] Validate spec... ✓ Validate spec (1245ms)
└─ [2/2] Analyze dependencies... ✓ Analyze dependencies (892ms)
✅ Wave 1 complete
  └─ Checkpoint saved (wave 1)

📊 Wave 2: Code Generation
├─ Tasks: Generate core files, Generate tests
├─ [1/2] Generate core files... ✓ Generate core files (2105ms)
└─ [2/2] Generate tests... 

✗ Failed: Generate tests

🔴 Error Analysis
Root Cause: Missing or invalid import statement
Category: IMPORT
Severity: critical
Confidence: 95%

Affected Files:
  ├─ src/auth/tests/auth.test.ts

💡 Suggested Fix:
  npm install --save-dev @types/jest

🔄 Recovery Options:
  [R] Retry (Attempt 1/3)
     Apply suggested fix and retry
  [S] Skip and Continue
     Skip this task and continue (may cause issues)
  [B] Rollback All Changes
     Restore to previous checkpoint
  [Q] Quit and Save State
     Exit and save current checkpoint for later retry

Choice [R/S/B/Q] [R]: r

⟳ Retrying with Fix (Attempt 1/3)
Task: Generate tests
Fix Applied: npm install --save-dev @types/jest
Running...

✓ Generate tests (1856ms, retry success!)
✅ Wave 2 complete
  └─ Checkpoint saved (wave 2)

[... Wave 3, 4 continue ...]

✅ Implementation complete!

Checkpoints available for:
  /sdd-impl auth --rollback-to 1
  /sdd-impl auth --rollback-to 2
  /sdd-impl auth --rollback-to 3
```

---

## Advanced Usage | Uso Avanzado

### Resume After Interruption
```bash
# Session interrupted during wave 3
# Next day, resume from wave 2 (last successful):

$ /sdd-impl auth --resume 2
▶️  Resuming Feature: auth

📌 Checkpoint Information
├─ Feature: auth
├─ Wave: 2
├─ Saved: 2026-09-17 19:10:00
├─ Files: 5
└─ Tasks: 2/2 completed

Next wave: 3
Run: /sdd-impl auth --checkpoint to continue
```

### Clean Rollback to Wave 1
```bash
$ /sdd-impl auth --rollback-to 1

🔙 Rolling Back Feature: auth

📌 Checkpoint Information
├─ Feature: auth
├─ Wave: 1
├─ Files: 3
└─ Tasks: 2/2 completed

Roll back to wave 1? This will restore files to checkpoint state. (y/n) [n]: y

🔙 Rolling Back Changes
✓ Restored 3/3 files

State saved. Run /sdd-impl to retry from next wave.
```

---

## Checkpoint Storage | Almacenamiento

```
.sdd/
└── .checkpoints/
    └── auth/
        ├── wave-1.json (3.2 KB)
        ├── wave-2.json (4.5 KB)
        ├── wave-3.json (5.1 KB)
        └── wave-4.json (5.8 KB)
```

**Auto-cleanup:** Mantiene últimos 5 checkpoints por feature (limpia automáticamente)

---

## Comparison | Comparación

| Feature | Copilot | Codeium | Cursor | Open-SDD |
|---------|---------|---------|--------|----------|
| Error Analysis | ❌ | ❌ | ❌ | ✅ AI-based |
| Smart Retry | ❌ | ❌ | ⚠️ Manual | ✅ Auto |
| Checkpointing | ❌ | ❌ | ❌ | ✅ Per-wave |
| Rollback | ❌ | ❌ | ❌ | ✅ Automatic |
| Root Cause Detection | ❌ | ❌ | ❌ | ✅ Semantic |

---

## Integration with Features 1 & 2

- **Feature 1 (Diff Preview):** Rollback usa same diff logic para calcular archivos affectados
- **Feature 2 (EARS Strict):** Error analysis puede sugerir mejoras de spec si falla generación
- **Feature 3 (Rollback & Retry):** Orchestración central para ejecución multi-wave confiable

---

## Configuration | Configuración

**Retries por task:** `maxRetries = 3` (configurable)

**Checkpoints a mantener:** `keepCount = 5` (auto-cleanup)

**Timeout per wave:** Infinite (se puede agregar)

---

## Next Steps | Próximos Pasos

- [x] Feature 3 core implemented (failureRecovery.ts)
- [x] Feature 3 CLI handler (rollback-retry.ts)
- [x] TypeScript strict mode (0 errors)
- [ ] Wire to main CLI router (`src/cli/index.ts`)
- [ ] Add tests (80%+ coverage target)
- [ ] Integration tests with real open-sdd repo

---

**Ready to handle failures gracefully. 🚀**
