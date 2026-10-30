# ==========================================================
# PriviLens X
# AI Chat Routes
# ==========================================================

from fastapi import APIRouter
from pydantic import BaseModel

from chat_engine import chat_engine

router = APIRouter(
    prefix="/chat",
    tags=["AI Chat"]
)

# ==========================================================
# STORE LATEST SIGNAL
# ==========================================================

latest_signal = {}

# ==========================================================
# UPDATE SIGNAL
# ==========================================================

def update_latest_signal(signal: dict):
    """
    Called by app.py whenever a new website
    analysis is completed.
    """
    global latest_signal
    latest_signal = signal


# ==========================================================
# REQUEST MODEL
# ==========================================================

class ChatRequest(BaseModel):

    question: str


# ==========================================================
# RESPONSE MODEL
# ==========================================================

class ChatResponse(BaseModel):

    question: str

    answer: str


# ==========================================================
# AI CHAT
# ==========================================================

@router.post("/", response_model=ChatResponse)

def ask_ai(request: ChatRequest):

    if latest_signal == {}:

        return ChatResponse(

            question=request.question,

            answer=(
                "No website has been analysed yet. "
                "Please analyse a website before "
                "asking AI questions."
            )

        )

    answer = chat_engine.ask(

        request.question,

        latest_signal

    )

    return ChatResponse(

        question=request.question,

        answer=answer

    )


# ==========================================================
# HEALTH CHECK
# ==========================================================

@router.get("/status")

def status():

    return {

        "status": "online",

        "engine": "PriviLens AI Chat",

        "ready": latest_signal != {}

    }


# ==========================================================
# CLEAR MEMORY
# ==========================================================

@router.delete("/clear")

def clear():

    global latest_signal

    latest_signal = {}

    return {

        "status": "success",

        "message": "Latest AI context cleared."

    }