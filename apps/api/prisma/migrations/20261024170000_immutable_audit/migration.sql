-- Audit logs and fare history are append-only. Block UPDATE and DELETE at the
-- database level so that no application bug or ad-hoc query can rewrite history.
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';

CREATE TRIGGER fare_history_no_update BEFORE UPDATE ON fare_history FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fare_history is append-only';

CREATE TRIGGER fare_history_no_delete BEFORE DELETE ON fare_history FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fare_history is append-only';

-- Defence in depth for seat inventory: a trip instance can never record more
-- booked seats than its capacity.
ALTER TABLE shared_trip_instances
  ADD CONSTRAINT chk_trip_seats CHECK (seatsBooked >= 0 AND seatsBooked <= capacity);

ALTER TABLE ratings ADD CONSTRAINT chk_rating_score CHECK (score BETWEEN 1 AND 5);

ALTER TABLE bookings ADD CONSTRAINT chk_booking_seats CHECK (seatCount BETWEEN 1 AND 6);
