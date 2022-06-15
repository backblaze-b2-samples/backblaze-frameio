import logging
import platform
from typing import Optional

import simplejson as json
import uvicorn
from fastapi import BackgroundTasks, FastAPI, Request
from starlette.responses import Response

import archival
from config import (
    NGROK_HOSTNAME, 
    NGROK_TOKEN,
    PORT
)

logger = logging.getLogger()


# if platform.system() == 'Darwin':
    # This is how I do the really simple tunneling from a local machine -> the web \
    #  so that the API can send requests to this service
    # from pyngrok import ngrok
    # ngrok.set_auth_token(NGROK_TOKEN)
    # ssh_tunnel = ngrok.connect(PORT, hostname=NGROK_HOSTNAME)

app = FastAPI()

@app.post("/archive")
async def main(
    request: Request,
    background_tasks: BackgroundTasks,
    settings: Optional[str] = None,
):
    payload = await request.json()

    if 'data' in payload.keys():
        background_tasks.add_task(archival.archive_data, payload)
        return Response(
            status_code=200
        )

    else:
        response = archival.build_payload(payload)
        return Response(
            media_type='application/json', 
            content=json.dumps(response), 
            status_code=200
        )

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=PORT, log_level="info", reload=True)
