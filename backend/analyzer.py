from urllib.parse import urlparse


def analyze_website(url: str):

    # Add https if missing
    if not url.startswith("http"):
        url = "https://" + url

    parsed = urlparse(url)

    domain = parsed.netloc

    https_enabled = parsed.scheme == "https"

    result = {
        "website": domain,
        "https": https_enabled
    }

    return result