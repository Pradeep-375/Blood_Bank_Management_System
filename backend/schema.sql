create table if not exists users(
  id serial primary key, name varchar(100) not null, email varchar(120) unique not null,
  password_hash text not null,
  role varchar(20) not null check(role in('admin','staff','donor','hospital')),
  hospital_name varchar(120), created_at timestamp default now());
create table if not exists donors(
  id serial primary key, user_id int unique references users(id) on delete cascade,
  blood_group varchar(3) not null, phone varchar(20), dob date, city varchar(60),
  created_at timestamp default now());
create table if not exists blood_requests(
  id serial primary key, hospital_id int references users(id),
  blood_group varchar(3) not null, units int not null check(units>0),
  urgency varchar(10) default 'normal',
  status varchar(10) default 'pending' check(status in('pending','approved','rejected','issued')),
  note text, decided_by int references users(id), created_at timestamp default now());
create table if not exists blood_units(
  id serial primary key, donor_id int references donors(id), blood_group varchar(3) not null,
  volume_ml int default 450, collected_on date not null default current_date, expiry_on date not null,
  status varchar(10) default 'available' check(status in('available','issued','expired')),
  request_id int references blood_requests(id), created_by int references users(id));
create index if not exists idx_units_group_status on blood_units(blood_group,status);
