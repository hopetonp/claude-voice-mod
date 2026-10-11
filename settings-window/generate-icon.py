"""Generate the settings window icon without a graphics dependency."""

from pathlib import Path
import struct
import zlib

size = 128
pixels = bytearray()
bars = ((43, 18), (52, 37), (61, 24), (70, 32), (79, 18))
for y in range(size):
    pixels.append(0)
    for x in range(size):
        inside = (x - 64) ** 2 + (y - 64) ** 2 <= 54 ** 2
        color = (53, 68, 91, 255) if inside else (0, 0, 0, 0)
        for center, height in bars:
            if abs(x - center) <= 2 and abs(y - 64) <= height:
                color = (205, 223, 249, 255)
                break
        pixels.extend(color)

def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">2I5B", size, size, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(pixels), 9))
png += chunk(b"IEND", b"")
target = Path(__file__).parent / "src-tauri" / "icons" / "icon.png"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(png)
