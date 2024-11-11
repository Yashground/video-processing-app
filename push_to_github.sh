#!/bin/bash

# Configure git with token-based authentication
git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"

# Initialize repository if not already initialized
git init

# Configure git user
git config --global user.email "replit@example.com"
git config --global user.name "Replit User"

# Add all files
git add .

# Commit changes
git commit -m "Initial commit: Video processing application with security measures"

# Create and push to main branch
git branch -M main
git remote add origin https://github.com/user/video-text-extractor.git
git push -u origin main --force
