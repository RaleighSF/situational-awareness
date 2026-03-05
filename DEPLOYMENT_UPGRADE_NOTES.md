# Deployment & Upgrade Notes (March 2026)

## 🏗 Migration Overview
On **March 5, 2026**, the VSS (Video Search System) application was migrated via AMI from a legacy AWS account to a new instance.

### 📍 Instance Details
*   **Host**: `ec2-54-205-252-206.compute-1.amazonaws.com`
*   **User**: `ubuntu`
*   **SSH Key**: `~/Downloads/nvidia_vlm.pem`
*   **GPU**: NVIDIA L40S (45GB VRAM)

---

## ⚙️ Service Architecture
The system consists of four primary systemd services running on the EC2 instance:

1.  **`cosmos-api.service`** (Port 8000)
    *   **Description**: Cosmos-Reason2-8B Vision-Language Model (VLM).
    *   **Root Process**: `/opt/pytorch/bin/python3 -m uvicorn app:app` in `/home/ubuntu`.
    *   **Endpoint**: `http://localhost:8000`

2.  **`vss-api.service`** (Port 8200)
    *   **Description**: Gateway API for VSS RAG and Metadata.
    *   **Root Process**: `uvicorn main:app` in `/home/ubuntu/vss/backend`.
    *   **Config**: Environment variables loaded from `/home/ubuntu/vss/.env`.

3.  **`vss-frontend.service`** (Port 5000)
    *   **Description**: Cosmos-Watcher application (Node/Express backend + React frontend).
    *   **Root Process**: `node dist/index.cjs` in `/home/ubuntu/vss/frontend`.
    *   **Role**: Handles UI and frame capture requests from the VSS API.

4.  **`cloudflared.service`**
    *   **Description**: Cloudflare tunnel daemon for external access.

---

## 🛠 Critical Configuration Learnt
### 1. Endpoint Mismatch Fix
During the migration, it was found that the `.env` file in `/home/ubuntu/vss/` was still pointing to the old external tunnel URL (`https://cosmos.agentdemos.com`).
*   **Fix**: Updated `COSMOS_ENDPOINT` to `http://localhost:8000` to use the local service.
*   **Action**: `sed -i 's|COSMOS_ENDPOINT=https://cosmos.agentdemos.com|COSMOS_ENDPOINT=http://localhost:8000|g' /home/ubuntu/vss/.env`

### 2. Cold-Start Model Loading Behavior
The L40S GPU takes significant time to load the **Cosmos-Reason2-8B** model (approx. 16GB) from the NVMe disk.
*   **Observation**: Disk I/O throughput was measured at ~6 MB/s during cold-start.
*   **Impact**: Total load time can exceed **45 minutes**.
*   **Diagnostics**: Use `nvidia-smi` to monitor VRAM usage and `cat /proc/<pid>/io` to monitor `read_bytes` for progress.

---

## 🩺 Smoke Test Commands
Verify health across all services with:
```bash
# VSS Gateway Health
curl http://localhost:8200/api/health

# Cosmos VLM Health
curl http://localhost:8000/health

# Frontend Capture API Check
curl -X POST http://localhost:5000/api/capture-frame -H "Content-Type: application/json" -d '{"url":"test"}'
```
