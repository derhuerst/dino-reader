'use strict'

const pump = require('pump')
const fs = require('fs')
const stripBomStream = require('strip-bom-stream')
const parseCsv = require('csv-parser')
const {decodeStream} = require('iconv-lite')

const readCsv = (src) => {
	const out = parseCsv({separator: ';'})
	return pump(
		fs.createReadStream(src),
		stripBomStream(),
		decodeStream('ISO-8859-1'),
		out,
		err => out.destroy(err)
	)
	// todo: trim whitespace in columns
}

module.exports = readCsv
