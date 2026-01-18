# Situational Awareness Demo

**Version 1.0** - Milestone release (January 2026)

A demo application showcasing the capabilities of NVIDIA Cosmos Reason 2 vision language model for security monitoring and situational awareness.

## Version History

### v2.0 (Current)
- Production reset: Each deployment resets prod database to match dev demo state
- No stale data: All old/duplicate entries cleared on prod startup
- Dev sync: Development seed removes sources not in demo list
- Auto-persist uploads: Videos automatically copy to /attached_assets/ on upload
- Clean filenames: Uploads get sanitized names (e.g., "Parking Lot" → "parking-lot.mp4")
- File size limit: Individual videos must be under 50MB for deployment
- Canonical demo data: Video sources, settings, and prompts are defined in server/storage.ts
- Parking lot video converted from MOV to MP4 for better browser compatibility
- Cosmos API health check: Header shows real-time API status and model load state

### v1.8
- Upload/delete buttons hidden in production mode
- Videos should be uploaded in Development, then published
- All video data (sources, prompts, alerts, settings) persists in database across deployments

### v1.7
- Production fix: Reverted to local file storage for video uploads
- Videos now upload via multipart/form-data to /api/video-sources/upload (multer-based)
- Removed broken Object Storage entries from database
- Note: Object Storage sidecar (127.0.0.1:1106) is unavailable in production deployments

### v1.6
- Attempted GCS URL fix (deprecated in favor of v1.7 local storage approach)

### v1.5
- Attempted Cloud Object Storage integration (deprecated - doesn't work in production)

### v1.4
- Quick Frame Analysis: Camera icon opens modal to ask ad-hoc questions about captured frames
- Uses /api/analyze-adhoc endpoint for free-form prompts without saving rules
- Enhanced Scene Agent reliability with 2048 token limit and fallback parsing for truncated responses

### v1.3
- Source-specific alerts: Alerts panel now filters by current video source instead of showing all alerts
- Upload name dialog: Users can enter friendly names for uploaded videos instead of displaying raw filenames
- Improved upload UX with cancel functionality and loading states

### v1.2
- Video upload capability: Users can upload MP4, WebM, OGG, or QuickTime videos (max 100MB)
- Video source deletion: Uploaded sources can be deleted along with associated prompts and alerts
- Upload files stored in /uploads directory with static serving
- Green pulsing animation on AI Analysis card during active analysis (matches Scene Agent visuals)

### v1.1
- Source-specific profiles: Each video source maintains independent detection rules, bounding boxes, and Scene Agent settings
- Database-driven video sources with settings stored in video_sources.settings JSONB column
- Prompts filtered by videoSourceId for source-specific rule management
- Scene context persisted per-source instead of global localStorage

### v1.0
- Batch inference via `/infer_batch` endpoint (single network call for all frames)
- Scene Agent with 30-second recording phase, 10-second analysis phase
- Optimized UI timing to match actual batch processing performance
- Subtle glow effects during recording/analysis phases
- Schema improvements for null handling in scene agent events
- Accessibility improvements for modal dialogs

## Overview

This application demonstrates how AI-powered vision analysis can automate security monitoring tasks that traditionally require human operators to watch video feeds continuously. Security administrators can create custom detection rules (prompts) that the AI will analyze against video frames at configurable intervals.

## Key Features

- **Video Feed Monitoring**: Displays a looped video feed with playback controls
- **Bounding Box Drawing**: Draw regions of interest on the video to focus AI analysis on specific areas
- **Detection Rules**: Create custom prompts that describe what the AI should look for
- **Configurable Frequency**: Set how often each rule should be analyzed (5-300 seconds)
- **Real-time Alerts**: Get notified when the AI detects conditions matching your rules
- **Alert History**: View past detections with frame captures and analysis details
- **Scene Agent**: Temporal reasoning analysis that captures 6 frames over 20 seconds, processes them via batch inference, and synthesizes a structured report with summary, timeline events, anomalies, and escalations

## Technology Stack

- **Frontend**: React with TypeScript, Tailwind CSS, shadcn/ui components
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI Integration**: NVIDIA Cosmos Reason 2 VLM via API
- **State Management**: TanStack Query

## Project Structure

```
├── client/src/
│   ├── components/       # UI components
│   │   ├── video-player.tsx      # Video player with bounding box drawing
│   │   ├── prompt-card.tsx       # Detection rule card display
│   │   ├── prompt-form.tsx       # Create/edit detection rules
│   │   ├── alert-list.tsx        # Alerts listing
│   │   ├── alert-detail-modal.tsx # Alert details view
│   │   └── analysis-status.tsx   # AI analysis status panel
│   ├── pages/
│   │   └── dashboard.tsx         # Main application page
│   └── lib/
│       └── queryClient.ts        # API client configuration
├── server/
│   ├── routes.ts         # API endpoints
│   ├── storage.ts        # Database operations
│   └── db.ts             # Database connection
└── shared/
    └── schema.ts         # Data models and types
```

## API Endpoints

- `GET /api/video-sources` - List all video sources with settings
- `POST /api/video-sources/upload` - Upload a video file to create a new source (multipart/form-data, legacy local storage)
- `POST /api/video-sources/request-upload-url` - Get presigned URL for cloud video upload
- `POST /api/video-sources/complete-upload` - Complete cloud upload and create video source
- `GET /objects/*` - Serve videos from cloud object storage
- `DELETE /api/video-sources/:id` - Delete a video source and its associated prompts/alerts (handles both local and cloud files)
- `PATCH /api/video-sources/:id/settings` - Update source settings (boundingBox, sceneContext)
- `GET /api/prompts?videoSourceId=xxx` - List detection rules for a specific source
- `POST /api/prompts` - Create a new detection rule (requires videoSourceId)
- `PATCH /api/prompts/:id` - Update a detection rule
- `DELETE /api/prompts/:id` - Delete a detection rule
- `GET /api/alerts` - List all alerts
- `PATCH /api/alerts/:id` - Update an alert (mark as read)
- `DELETE /api/alerts` - Clear all alerts
- `POST /api/analyze` - Analyze a video frame with a specific prompt
- `POST /api/analyze-adhoc` - Ad-hoc frame analysis with free-form prompt (no saved rule)
- `POST /api/scene-agent/run` - Run Scene Agent temporal analysis on captured frames
- `GET /api/cosmos/health` - Check Cosmos endpoint health status
- `GET /api/video/proxy` - Proxy video streams with CORS headers
- `GET /api/test/frame` - Get a test frame for fallback testing

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `COSMOS_ENDPOINT` - Custom Cosmos Reason 2 endpoint URL (default: https://cosmos.agentdemos.com)
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` - Replit Object Storage bucket ID for video persistence
- `PRIVATE_OBJECT_DIR` - Directory path for private objects (uploaded videos)
- `PUBLIC_OBJECT_SEARCH_PATHS` - Search paths for public assets

Note: The COSMOS_ENDPOINT points to a self-hosted Cosmos Reason 2 inference server. No API key is required as authentication is handled at the infrastructure level (Cloudflare/EC2).

## Usage

1. The video feed starts playing automatically
2. Optionally draw a bounding box to focus on a specific region
3. Create detection rules describing what to look for
4. Click "Start" to begin AI analysis
5. Alerts appear when conditions are detected

## Data Models

### VideoSource
- Video feed configuration (id, name, url, isActive, settings)
- settings: JSONB column containing boundingBox and sceneContext per source

### Prompt
- Detection rules with name, prompt text, bounding box, frequency, active status, videoSourceId

### Alert
- Detection events with timestamp, frame data, analysis result, confidence
