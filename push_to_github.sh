#!/bin/bash

# Create repository first
echo "Creating GitHub repository..."
curl -X POST -H "Authorization: token ${GITHUB_TOKEN}" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/user/repos \
     -d '{"name":"video-processing-app","description":"A video processing application that extracts text content from YouTube videos","private":false}'

# Wait a moment for repository creation
sleep 2

# Remove existing remote if it exists
git remote remove origin || true

# Initialize repository if not already initialized
git init

# Configure git user
git config --global user.email "replit@example.com"
git config --global user.name "Replit User"

# Configure git with token-based authentication
git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"

# Add all files
git add .

# Commit changes
git commit -m "Initial commit: Video processing application with security measures"

# Get the GitHub username from the API
GITHUB_USERNAME=$(curl -H "Authorization: token ${GITHUB_TOKEN}" \
                      -H "Accept: application/vnd.github.v3+json" \
                      https://api.github.com/user | grep -o '"login": *"[^"]*"' | cut -d'"' -f4)

# Create and push to main branch
git branch -M main
git remote add origin "https://github.com/${GITHUB_USERNAME}/video-processing-app.git"
git push -u origin main --force
