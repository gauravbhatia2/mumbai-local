create extension if not exists citext;

create table if not exists stations (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name citext not null unique,
  line text not null
);

create table if not exists refresh_state (
  singleton boolean primary key default true check (singleton),
  active_slot text not null check (active_slot in ('current', 'new')),
  last_refresh_started_at timestamptz,
  last_refresh_completed_at timestamptz,
  last_refresh_status text not null default 'idle',
  last_refresh_message text,
  source_checksum text
);

insert into refresh_state (singleton, active_slot, last_refresh_status)
values (true, 'current', 'idle')
on conflict (singleton) do nothing;

create or replace view refresh_status_view as
select
  active_slot,
  last_refresh_started_at,
  last_refresh_completed_at,
  last_refresh_status,
  last_refresh_message,
  source_checksum
from refresh_state
where singleton = true;

create table if not exists trains_current (
  id text primary key,
  name text not null,
  origin_station_id bigint not null references stations(id),
  destination_station_id bigint not null references stations(id),
  type text not null check (type in ('fast', 'slow'))
);

create table if not exists trains_new (
  id text primary key,
  name text not null,
  origin_station_id bigint not null references stations(id),
  destination_station_id bigint not null references stations(id),
  type text not null check (type in ('fast', 'slow'))
);

create table if not exists stops_current (
  id bigint generated always as identity primary key,
  train_id text not null references trains_current(id) on delete cascade,
  station_id bigint not null references stations(id),
  arrival_time time not null,
  departure_time time not null,
  stop_order integer not null check (stop_order > 0),
  unique (train_id, stop_order)
);

create table if not exists stops_new (
  id bigint generated always as identity primary key,
  train_id text not null references trains_new(id) on delete cascade,
  station_id bigint not null references stations(id),
  arrival_time time not null,
  departure_time time not null,
  stop_order integer not null check (stop_order > 0),
  unique (train_id, stop_order)
);

create index if not exists trains_current_origin_idx
  on trains_current (origin_station_id, type);
create index if not exists trains_new_origin_idx
  on trains_new (origin_station_id, type);
create index if not exists stops_current_station_time_idx
  on stops_current (station_id, departure_time);
create index if not exists stops_new_station_time_idx
  on stops_new (station_id, departure_time);
create index if not exists stops_current_train_order_idx
  on stops_current (train_id, stop_order);
create index if not exists stops_new_train_order_idx
  on stops_new (train_id, stop_order);

create or replace view trains_live as
select t.*
from trains_current t
cross join refresh_state s
where s.singleton = true and s.active_slot = 'current'
union all
select t.*
from trains_new t
cross join refresh_state s
where s.singleton = true and s.active_slot = 'new';

create or replace view stops_live as
select s.*
from stops_current s
cross join refresh_state r
where r.singleton = true and r.active_slot = 'current'
union all
select s.*
from stops_new s
cross join refresh_state r
where r.singleton = true and r.active_slot = 'new';

create or replace function search_trains(
  p_source_station_id bigint,
  p_destination_station_id bigint,
  p_depart_after time default null,
  p_origin_only boolean default false,
  p_limit integer default 15
)
returns table (
  train_id text,
  train_name text,
  train_type text,
  origin_station_name text,
  destination_station_name text,
  departure_time text,
  arrival_time text,
  starts_here boolean,
  journey_minutes integer
)
language sql
stable
as $$
  with candidate_trains as (
    select
      t.id as train_id,
      t.name as train_name,
      t.type as train_type,
      origin_station.name::text as origin_station_name,
      destination_station.name::text as destination_station_name,
      source_stop.departure_time,
      destination_stop.arrival_time,
      (t.origin_station_id = p_source_station_id) as starts_here,
      greatest(
        floor(extract(epoch from (destination_stop.arrival_time - source_stop.departure_time)) / 60)::integer,
        0
      ) as journey_minutes
    from trains_live t
    join stops_live source_stop
      on source_stop.train_id = t.id
     and source_stop.station_id = p_source_station_id
    join stops_live destination_stop
      on destination_stop.train_id = t.id
     and destination_stop.station_id = p_destination_station_id
     and source_stop.stop_order < destination_stop.stop_order
    join stations origin_station
      on origin_station.id = t.origin_station_id
    join stations destination_station
      on destination_station.id = t.destination_station_id
    where (p_depart_after is null or source_stop.departure_time >= p_depart_after)
      and (not p_origin_only or t.origin_station_id = p_source_station_id)
  )
  select
    train_id,
    train_name,
    train_type,
    origin_station_name,
    destination_station_name,
    to_char(departure_time, 'HH24:MI') as departure_time,
    to_char(arrival_time, 'HH24:MI') as arrival_time,
    starts_here,
    journey_minutes
  from candidate_trains
  order by departure_time asc, starts_here desc
  limit least(greatest(p_limit, 1), 15);
$$;
