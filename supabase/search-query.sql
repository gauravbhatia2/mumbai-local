select
  t.id as train_id,
  t.name as train_name,
  t.type as train_type,
  origin_station.name as origin_station_name,
  destination_station.name as destination_station_name,
  to_char(source_stop.departure_time, 'HH24:MI') as departure_time,
  to_char(destination_stop.arrival_time, 'HH24:MI') as arrival_time,
  (t.origin_station_id = $1) as starts_here
from trains_live t
join stops_live source_stop
  on source_stop.train_id = t.id
 and source_stop.station_id = $1
join stops_live destination_stop
  on destination_stop.train_id = t.id
 and destination_stop.station_id = $2
 and source_stop.stop_order < destination_stop.stop_order
join stations origin_station
  on origin_station.id = t.origin_station_id
join stations destination_station
  on destination_station.id = t.destination_station_id
where source_stop.departure_time >= $3::time
  and ($4::boolean = false or t.origin_station_id = $1)
order by source_stop.departure_time asc, starts_here desc
limit 15;

