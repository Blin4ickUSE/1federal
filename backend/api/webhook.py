"""CloudPayments webhook Flask app (dedicated container on port 5000)."""

from __future__ import annotations

import logging
import os

from flask import Flask, jsonify, request

from backend.api import cloudpayments
from backend.api.cp_notify import process_cloudpayments_request

logger = logging.getLogger(__name__)
app = Flask(__name__)


@app.route('/cloudpayments', methods=['GET', 'POST'])
@app.route('/cloudpayments/<event>', methods=['GET', 'POST'])
def cloudpayments_webhook(event: str = None):
    return process_cloudpayments_request(request, event)


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'cloudpayments_configured': cloudpayments.cloudpayments_api.is_configured,
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('WEBHOOK_PORT', 5000)))
