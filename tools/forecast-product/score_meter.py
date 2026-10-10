#!/usr/bin/env python3
import sys
from forecast_product import main

if __name__ == "__main__":
    sys.exit(main(["score", *sys.argv[1:]]))
