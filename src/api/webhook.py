"""T-Bank webhook Flask app (dedicated container on port 5000)."""

from __future__ import annotations

import logging
import os

from flask import Flask, jsonify, request

from src.api import tbank

logger = logging.getLogger(__name__)
app = Flask(__name__)


@app.route('/tbank', methods=['GET', 'POST'])
@app.route('/tbank/notification', methods=['GET', 'POST'])
def tbank_webhook():
    return tbank.process_tbank_request(request)


# Backward-compatible aliases (old nginx configs / bookmarks)
@app.route('/cloudpayments', methods=['GET', 'POST'])
@app.route('/cloudpayments/<event>', methods=['GET', 'POST'])
def legacy_cloudpayments_alias(event: str = None):
    return tbank.process_tbank_request(request)


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'tbank_configured': tbank.tbank_api.is_configured,
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
