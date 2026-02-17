#!/bin/bash
# Forge AI Studio - Full Stack Starter
# Usage: ./start.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KB_DIR="$SCRIPT_DIR/kb-service"
FRONTEND_DIR="$SCRIPT_DIR/forge-ai-studio"
VENV_DIR="$KB_DIR/venv"
KB_PORT=8833
FRONTEND_PORT=3000
KB_PID_FILE="$SCRIPT_DIR/.kb-service.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Forge AI Studio ===${NC}"
echo ""

# ---- KB Service ----
echo -e "${CYAN}[1/2] KB Service${NC}"

if [ -f "$KB_PID_FILE" ]; then
    OLD_PID=$(cat "$KB_PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "${YELLOW}  Already running (PID: $OLD_PID)${NC}"
    else
        rm -f "$KB_PID_FILE"
    fi
fi

if [ ! -f "$KB_PID_FILE" ]; then
    if [ ! -f "$VENV_DIR/bin/uvicorn" ]; then
        echo -e "${RED}  Error: venv not found at $VENV_DIR${NC}"
        echo "  Run: cd $KB_DIR && python3 -m venv venv && venv/bin/pip install -r requirements.txt"
    else
        echo -e "${GREEN}  Starting on port $KB_PORT...${NC}"
        "$VENV_DIR/bin/uvicorn" main:app \
            --host 0.0.0.0 \
            --port "$KB_PORT" \
            --reload \
            --app-dir "$KB_DIR" \
            > /tmp/kb-service.log 2>&1 &
        echo $! > "$KB_PID_FILE"
        sleep 2
        if kill -0 "$(cat "$KB_PID_FILE")" 2>/dev/null; then
            echo -e "${GREEN}  KB service started (PID: $(cat "$KB_PID_FILE"))${NC}"
        else
            echo -e "${RED}  Failed! Check: cat /tmp/kb-service.log${NC}"
            rm -f "$KB_PID_FILE"
        fi
    fi
fi

# ---- Frontend ----
echo -e "${CYAN}[2/2] Frontend (Vite)${NC}"

if [ -f "$FRONTEND_PID_FILE" ]; then
    OLD_PID=$(cat "$FRONTEND_PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "${YELLOW}  Already running (PID: $OLD_PID)${NC}"
    else
        rm -f "$FRONTEND_PID_FILE"
    fi
fi

if [ ! -f "$FRONTEND_PID_FILE" ]; then
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo -e "${YELLOW}  Installing dependencies...${NC}"
        (cd "$FRONTEND_DIR" && npm install) > /tmp/frontend-install.log 2>&1
    fi
    echo -e "${GREEN}  Starting on port $FRONTEND_PORT...${NC}"
    (cd "$FRONTEND_DIR" && npx vite --port "$FRONTEND_PORT" --host 0.0.0.0) > /tmp/frontend.log 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
    sleep 3
    if kill -0 "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null; then
        echo -e "${GREEN}  Frontend started (PID: $(cat "$FRONTEND_PID_FILE"))${NC}"
    else
        echo -e "${RED}  Failed! Check: cat /tmp/frontend.log${NC}"
        rm -f "$FRONTEND_PID_FILE"
    fi
fi

# ---- Summary ----
echo ""
echo -e "${CYAN}=== Services ===${NC}"
echo "  KB API:   http://localhost:$KB_PORT/docs"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  Logs:     /tmp/kb-service.log, /tmp/frontend.log"
echo ""
echo -e "${GREEN}Use ./stop.sh to stop all services${NC}"
