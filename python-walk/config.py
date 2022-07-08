import os
import dotenv

# Load dotenv
dotenv.load_dotenv('/Users/elton/Development/python/backblazeframeio/.env')

# Globals
PORT = os.getenv('PORT', 8000)

# AWS Config
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
S3_BUCKET = os.getenv("S3_BUCKET")
S3_ENDPOINT = os.getenv("S3_ENDPOINT")

# Frame.io Config
FIO_TOKEN = os.getenv('FIO_TOKEN')
print("Value of 'FIO_TOKEN' environment variable :", FIO_TOKEN)
# ngrok Config

NGROK_TOKEN = os.getenv('NGROK_TOKEN', "27B7xFlYdIHZRQOLEgVlfFe3MUp_4VDzd2BFL5RLpkwAcTEBf")
print("Value of 'NGROK_TOKEN' environment variable :", NGROK_TOKEN)
NGROK_HOSTNAME = os.getenv('NGROK_HOSTNAME')
