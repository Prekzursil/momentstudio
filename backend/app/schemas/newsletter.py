from pydantic import BaseModel, EmailStr, Field


class NewsletterSubscribeRequest(BaseModel):
    email: EmailStr
    source: str | None = Field(default="blog", max_length=64)
    captcha_token: str | None = Field(default=None, max_length=5000)


class NewsletterSubscribeResponse(BaseModel):
    subscribed: bool = True
    already_subscribed: bool = False

