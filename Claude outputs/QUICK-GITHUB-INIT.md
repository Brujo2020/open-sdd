# Create GitHub Repo in 2 Minutes

## Step 1: On GitHub.com

1. Go to https://github.com/new
2. Name: `open-sdd`
3. Description: "9 Production-Ready SDD Features"
4. Public (so install.sh URL works)
5. Click "Create repository"

## Step 2: Clone & Push (from your machine)

```bash
# Go to outputs folder
cd /mnt/user-data/outputs

# Initialize repo
git init
git add install.sh README.md GITHUB-README.md *.md
git commit -m "Initial commit: open-sdd 9 features"
git branch -M main

# Add remote (replace USERNAME)
git remote add origin https://github.com/USERNAME/open-sdd.git
git push -u origin main
```

## Step 3: Copy Source Files to Repo

From `open-sdd-final/` directory:

```bash
# Extract package
tar -xzf open-sdd-all-features.tar.gz

# Copy all source
cp -r open-sdd-final/src/* .
cp -r open-sdd-final/package.json .
cp -r open-sdd-final/tsconfig.json .

# Create LICENSE
cat > LICENSE << 'EOL'
MIT License

Copyright (c) 2026 Mario Alejandro

Permission is hereby granted, free of charge...
EOL

# Commit
git add .
git commit -m "feat: add source code + config"
git push
```

## Step 4: Create CI/CD

```bash
# Create workflow directory
mkdir -p .github/workflows

# Create build file
cat > .github/workflows/build.yml << 'EOL'
name: Build
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install chalk
      - run: npm run build
EOL

git add .github/workflows/build.yml
git commit -m "ci: add build workflow"
git push
```

## Step 5: Test Install URL

```bash
curl -fsSL https://github.com/YOUR_USERNAME/open-sdd/raw/main/install.sh | bash -s /path/to/open-sdd
```

✅ **Done.** Install script works globally now.

---

## If You Don't Have Git Locally

Use GitHub Web UI:

1. Create repo (Step 1 above)
2. Click "Add file" → "Upload files"
3. Upload: `install.sh`, `README.md`, all `.ts` files
4. Drag `open-sdd-final/src/` folder
5. Done

Then curl works. 🎯
