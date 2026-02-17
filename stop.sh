#!/bin/bash
# Forge AI Studio - Full Stack Stopper
# Usage: ./stop.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KB_PID_FILE="$SCRIPT_DIR/.kb-service.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"
KB_PORT=8833
FRONTEND_PORT=3000

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Stopping Forge AI Studio ===${NC}"
echo ""

stop_service() {
    local name="$1"
    local pid_file="$2"
    local port="$3"

    echo -e "${CYAN}[$name]${NC}"

    # Try PID file
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null
            sleep 1
            kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
            rm -f "$pid_file"
            echo -e "  ${GREEN}Stopped (PID: $PID)${NC}"
            return
        else
            rm -f "$pid_file"
        fi
    fi

    # Fallback: find by port
    PID=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$PID" ]; then
        kill $PID 2>/dev/null
        sleep 1
        kill -9 $PID 2>/dev/null 2>&1
        rm -f "$pid_file"
        echo -e "  ${GREEN}Stopped (port $port, PID: $PID)${NC}"
    else
        echo -e "  ${YELLOW}Not running${NC}"
    fi
}

stop_service "KB Service" "$KB_PID_FILE" "$KB_PORT"
stop_service "Frontend"   "$FRONTEND_PID_FILE" "$FRONTEND_PORT"

echo ""
echo -e "${GREEN}All services stopped${NC}"
