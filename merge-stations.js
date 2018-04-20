'use strict'

const {Writable} = require('stream')
const uniq = require('lodash/uniq')
const isEqual = require('lodash/isEqual')
const centroid = require('@turf/centroid').default

const computeCentroid = (points) => {
	const coords = []
	for (let p of points) coords.push([p.longitude, p.latitude])
	const p = centroid({
		type: 'MultiPoint',
		coordinates: coords
	}).geometry
	return {
		type: 'location',
		latitude: p.coordinates[1],
		longitude: p.coordinates[0]
	}
}

const mergeStations = (stationsStream, stopsStream, done) => {
	const stations = Object.create(null)

	const writeStation = (row, _, cb) => {
		const station = { // todo: use row.REF_STOP_NR for this?
			type: 'station',
			// versionId: row.VERSION.trim(),
			id: row.STOP_NR.trim(),
			name: row.STOP_NAME.trim(), // todo: use row.REF_STOP_NAME for this?
			location: {
				type: 'location',
				// todo: confirm that these are WGS84
				latitude: null,
				longitude: null
				// todo
				// latitude: row.STOP_POS_Y / 1000000,
				// longitude: row.STOP_POS_X / 1000000
			},
			ifoptId: row.IFOPT.trim(),
			gemeinde: row.OCC.trim(),
			stadt: row.PLACE.trim(),
			fareZones: uniq([ // wat
				parseInt(row.FARE_ZONE),
				parseInt(row.FARE_ZONE2),
				parseInt(row.FARE_ZONE3),
				parseInt(row.FARE_ZONE4),
				parseInt(row.FARE_ZONE5),
				parseInt(row.FARE_ZONE6)
			].filter(n => !Number.isNaN(n) && n !== -1)),
			stops: []
		}

		if (stations[station.id] && !isEqual(stations[station.id], station)) {
			return cb(new Error(`non-unique station ID ${station.id}`))
		}
		stations[station.id] = station
		cb()
	}

	const writeStop = (row, _, cb) => {
		const stationId = row.STOP_NR.trim()
		const station = stations[stationId]
		if (!station) return cb(new Error('unknown station ID ' + stationId))

		const stop = {
			type: 'stop',
			// todo: row.STOP_RBL_NR
			// todo: use row.REF_STOP_NR for this?
			id: row.STOPPING_POINT_NR.trim(),
			name: row.STOPPING_POINT_SHORTNAME.trim(),
			ifoptId: row.IFOPT.trim(),
			location: {
				type: 'location',
				// todo: confirm that these are WGS84
				latitude: row.STOPPING_POINT_POS_Y / 1000000,
				longitude: row.STOPPING_POINT_POS_X / 1000000
			}
		}

		if (!station.stops.some(stop2 => isEqual(stop, stop2))) {
			station.stops.push(stop)
		}
		cb()
	}

	const final = (cb) => {
		const writable = new Writable({
			objectMode: true, write: writeStop
		})
		writable.once('error', (err) => {
			writable.destroy(err)
			cb(err)
		})
		writable.once('finish', () => {
			for (let station of Object.values(stations)) {
				const locs = station.stops.map(s => s.location)
				station.location = computeCentroid(locs)
			}
			done(null, stations)
			cb()
		})
		stopsStream.pipe(writable)
	}

	const writable = new Writable({
		objectMode: true, write: writeStation, final
	})
	writable.once('error', (err) => {
		writable.destroy(err)
		done(err)
	})
	stationsStream.pipe(writable)
}

module.exports = mergeStations
