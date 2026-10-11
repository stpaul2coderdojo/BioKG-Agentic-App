#!/usr/bin/env bash
# ==============================================================================
# NVIDIA Brev Launchable Setup Script (.brev/setup.sh)
# Project: BioKG — Autonomous Bio-Agent Knowledge Graph Workbench
# Author: Dr. Bheemaiah Anil Kumar, Synergy Robotics, Seattle
# Supported Agent Runtimes:
#   1. NeMoClaw (Enterprise OpenClaw + NVIDIA NIM + OpenShell Guardrails)
#   2. OpenClaw (Open-Source Multi-Agent Swarm Runtime)
#   3. Nous Hermes Agent (NousResearch/Hermes-3-Llama-3.1-70B via vLLM / SGLang)
# ==============================================================================

set -euo pipefail

echo "[BioKG · NVIDIA Brev] Starting Brev GPU Launchable provisioning..."

# 1. Verify NVIDIA GPU & CUDA Runtime
if command -v nvidia-smi &> /dev/null; then
  echo "[BioKG · NVIDIA Brev] Detected NVIDIA GPU Accelerator:"
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
  echo "[BioKG · NVIDIA Brev] Running in CPU/Hybrid Brev mode."
fi

# 2. Install Node.js 22 LTS if not present
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 3. Install BioKG Workbench dependencies & compile production bundle
echo "[BioKG · NVIDIA Brev] Installing Node dependencies and compiling BioKG..."
npm install
npm run build

# 4. Select & Initialize Agent Orchestrator (NeMoClaw | OpenClaw | Hermes)
BIOKG_AGENT_RUNTIME="${BIOKG_AGENT_RUNTIME:-nemoclaw}"
echo "[BioKG · NVIDIA Brev] Configuring Agent Runtime: ${BIOKG_AGENT_RUNTIME}"

if [ -f "docker-compose.brev.yml" ] && command -v docker &> /dev/null; then
  echo "[BioKG · NVIDIA Brev] Docker Compose detected. Ready to launch via:"
  echo "  docker compose -f docker-compose.brev.yml --profile ${BIOKG_AGENT_RUNTIME} up -d"
fi

echo "[BioKG · NVIDIA Brev] Compilation complete. Launching BioKG server on port 3000..."
