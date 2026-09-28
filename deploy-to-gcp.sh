#!/bin/bash
# Script to deploy Sovereign Commander Console directly to Google Cloud Run / GCP Console

set -e

PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
SERVICE_NAME="sovereign-commander-console"

echo "=========================================================="
echo "🚀 Deploying Sovereign Commander Console to GCP"
echo "Project ID: $PROJECT_ID"
echo "Region:     $REGION"
echo "Service:    $SERVICE_NAME"
echo "=========================================================="

# Enable required Google Cloud APIs
echo "⚡ Enabling GCP APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# Deploy directly via Cloud Run source deploy
echo "📦 Building & Deploying to Google Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars NODE_ENV=production

echo "=========================================================="
echo "✅ Deployment complete!"
echo "Check your Cloud Run service URL in Google Cloud Console."
echo "=========================================================="
