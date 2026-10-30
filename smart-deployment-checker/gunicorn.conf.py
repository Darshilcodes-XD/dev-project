import os

bind = f"0.0.0.0:{os.getenv('PORT', '10000')}"
workers = 1
threads = 8
timeout = 120
accesslog = "-"
errorlog = "-"
