# Situational Awareness Demo

A demo application showcasing the capabilities of NVIDIA Cosmos Reason 2 vision language model for security monitoring and situational awareness.

## Overview

This application demonstrates how AI-powered vision analysis can automate security monitoring tasks that traditionally require human operators to watch video feeds continuously. Security administrators can create custom detection rules (prompts) that the AI will analyze against video frames at configurable intervals.

## Key Features

- **Video Feed Monitoring**: Displays a looped video feed with playback controls
- **Bounding Box Drawing**: Draw regions of interest on the video to focus AI analysis on specific areas
- **Detection Rules**: Create custom prompts that describe what the AI should look for
- **Configurable Frequency**: Set how often each rule should be analyzed (10-300 seconds)
- **Real-time Alerts**: Get notified when the AI detects conditions matching your rules
- **Alert History**: View past detections with frame captures and analysis details

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

- `GET /api/prompts` - List all detection rules
- `POST /api/prompts` - Create a new detection rule
- `PATCH /api/prompts/:id` - Update a detection rule
- `DELETE /api/prompts/:id` - Delete a detection rule
- `GET /api/alerts` - List all alerts
- `PATCH /api/alerts/:id` - Update an alert (mark as read)
- `DELETE /api/alerts` - Clear all alerts
- `POST /api/analyze` - Analyze a video frame with a specific prompt
- `GET /api/cosmos/health` - Check Cosmos endpoint health status

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `COSMOS_ENDPOINT` - Custom Cosmos Reason 2 endpoint URL (default: https://cosmos.agentdemos.com)

Note: The COSMOS_ENDPOINT points to a self-hosted Cosmos Reason 2 inference server. No API key is required as authentication is handled at the infrastructure level (Cloudflare/EC2).

## Usage

1. The video feed starts playing automatically
2. Optionally draw a bounding box to focus on a specific region
3. Create detection rules describing what to look for
4. Click "Start" to begin AI analysis
5. Alerts appear when conditions are detected

## Data Models

### VideoSource
- Video feed configuration (id, name, url, isActive)

### Prompt
- Detection rules with name, prompt text, bounding box, frequency, active status

### Alert
- Detection events with timestamp, frame data, analysis result, confidence
