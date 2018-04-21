'use strict'

const path = require('path')
const fs = require('fs')

const createReader = require('.')
const readCsv = require('./read-csv')
const mergeStations = require('./merge-stations')

const base = path.join(__dirname, 'vrr-2018-04-18')
const readFile = file => readCsv(path.join(base, file))

const reader = createReader(readFile, (err, res) => {
	if (err) {
		console.error(err)
		return process.exitCode = 1
	}

	// todo
	console.log(res)
})
