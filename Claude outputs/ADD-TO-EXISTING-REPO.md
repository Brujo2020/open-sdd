# Add Open-SDD to Existing Repo

Para agregar open-sdd a: `https://github.com/Brujo2020/CursoOpenUSD`

## Opción 1: Carpeta dentro del repo (Recomendado)

```bash
# Clone repo
git clone https://github.com/Brujo2020/CursoOpenUSD.git
cd CursoOpenUSD

# Crear carpeta open-sdd
mkdir -p open-sdd
cd open-sdd

# Copiar archivos
cp /mnt/user-data/outputs/install.sh .
cp /mnt/user-data/outputs/GITHUB-README.md README.md
cp /mnt/user-data/outputs/open-sdd-all-features.tar.gz .

# Extraer source
tar -xzf open-sdd-all-features.tar.gz

# Commit & push
cd ..
git add open-sdd/
git commit -m "feat: add open-sdd 9-feature suite"
git push origin main
```

**Resultado:**
```
github.com/Brujo2020/CursoOpenUSD/
└── open-sdd/
    ├── install.sh
    ├── README.md
    ├── open-sdd-all-features.tar.gz
    └── open-sdd-final/src/
```

**Install URL:**
```bash
curl -fsSL https://github.com/Brujo2020/CursoOpenUSD/raw/main/open-sdd/install.sh | bash -s /path/to/open-sdd
```

---

## Opción 2: Subdirectorio con docs

Estructura más limpia si hay múltiples proyectos:

```bash
git clone https://github.com/Brujo2020/CursoOpenUSD.git
cd CursoOpenUSD

# Estructura
mkdir -p tools/open-sdd/{src,scripts,docs}

# Copiar
cp /mnt/user-data/outputs/install.sh tools/open-sdd/scripts/
cp /mnt/user-data/outputs/GITHUB-README.md tools/open-sdd/README.md
tar -xzf /mnt/user-data/outputs/open-sdd-all-features.tar.gz -C tools/open-sdd/src/

# Commit
git add tools/open-sdd/
git commit -m "feat: add open-sdd tooling"
git push
```

**Install URL:**
```bash
curl -fsSL https://github.com/Brujo2020/CursoOpenUSD/raw/main/tools/open-sdd/scripts/install.sh | bash -s /path/to/open-sdd
```

---

## Opción 3: CI/CD para Validar

Agregar a `.github/workflows/build.yml`:

```yaml
name: Build & Validate

on: [push, pull_request]

jobs:
  build-opensdd:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - name: Build Open-SDD
        run: |
          cd open-sdd
          npm install chalk
          npm run build
```

---

## Recomendación

**Opción 1** es más simple:
- Fácil de encontrar en repo
- URL directa funciona
- Usuarios saben dónde está

Do it:

```bash
# 1. Clone
git clone https://github.com/Brujo2020/CursoOpenUSD.git
cd CursoOpenUSD

# 2. Copy
mkdir open-sdd
cp /mnt/user-data/outputs/install.sh open-sdd/
cp /mnt/user-data/outputs/GITHUB-README.md open-sdd/README.md
tar -xzf /mnt/user-data/outputs/open-sdd-all-features.tar.gz -C open-sdd/

# 3. Push
git add open-sdd/
git commit -m "feat: add open-sdd 9-feature suite"
git push origin main
```

**Done.** Install works globally. 🎯
