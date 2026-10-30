import json
import os
from datetime import datetime

HISTORY_FILE = "history.json"


def load_history():

    if not os.path.exists(HISTORY_FILE):
        return []

    with open(HISTORY_FILE, "r") as f:
        return json.load(f)


def save_scan(scan):

    history = load_history()

    scan["time"] = datetime.now().strftime("%d-%m-%Y %H:%M:%S")

    history.insert(0, scan)

    history = history[:100]

    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=4)


def get_history():

    return load_history()