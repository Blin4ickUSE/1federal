"""Platega webhook Flask app (dedicated container on port 5000)."""

from __future__ import annotations

import logging
import os

from flask import Flask, jsonify, request

from src.api import platega

logger = logging.getLogger(__name__)
app = Flask(__name__)


@app.route('/platega', methods=['GET', 'POST'])
def platega_webhook():
    return platega.process_platega_request(request)


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'platega_configured': platega.platega_api.is_configured,
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
