import uvicorn

from . import config

if __name__ == "__main__":
    uvicorn.run("ocr_service.app:app", host=config.HOST, port=config.PORT, log_level="info", workers=1)
