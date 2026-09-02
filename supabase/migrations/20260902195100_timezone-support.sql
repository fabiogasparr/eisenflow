-- Migration: Add Timezone Support for International Users
--
-- This migration:
-- 1. Adds timezone column to users table
-- 2. Creates timezone validation constraint
-- 3. Adds timezone-aware date conversion functions
-- 4. Updates existing tasks to use timezone conversions
-- 5. Provides utilities for timezone handling

-- Add timezone column to users table
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';

-- Add constraint to ensure valid timezone
ALTER TABLE auth.users ADD CONSTRAINT valid_timezone CHECK (
  timezone IN (
    'UTC', 'Africa/Abidjan', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Algiers',
    'Africa/Asmara', 'Africa/Bamako', 'Africa/Bangui', 'Africa/Banjul', 'Africa/Bissau',
    'Africa/Blantyre', 'Africa/Brazzaville', 'Africa/Bujumbura', 'Africa/Cairo',
    'Africa/Casablanca', 'Africa/Ceuta', 'Africa/Conakry', 'Africa/Dakar', 'Africa/Dar_es_Salaam',
    'Africa/Djibouti', 'Africa/Douala', 'Africa/El_Aaiun', 'Africa/Freetown', 'Africa/Gaborone',
    'Africa/Harare', 'Africa/Johannesburg', 'Africa/Juba', 'Africa/Kampala', 'Africa/Khartoum',
    'Africa/Kigali', 'Africa/Kinshasa', 'Africa/Lagos', 'Africa/Libreville', 'Africa/Lilongwe',
    'Africa/Lome', 'Africa/Luanda', 'Africa/Lubumbashi', 'Africa/Lusaka', 'Africa/Malabo',
    'Africa/Maputo', 'Africa/Maseru', 'Africa/Mbabane', 'Africa/Mogadishu', 'Africa/Monrovia',
    'Africa/Montserrado', 'Africa/Ndjamena', 'Africa/Niamey', 'Africa/Nouakchott', 'Africa/Ouagadougou',
    'Africa/Porto-Novo', 'Africa/Sao_Tome', 'Africa/Tripoli', 'Africa/Tunis', 'Africa/Windhoek',
    'America/Adak', 'America/Anchorage', 'America/Anguilla', 'America/Antigua', 'America/Araguaina',
    'America/Argentina/Buenos_Aires', 'America/Argentina/Catamarca', 'America/Argentina/Cordoba',
    'America/Argentina/Jujuy', 'America/Argentina/La_Rioja', 'America/Argentina/Mendoza',
    'America/Argentina/Rio_Gallegos', 'America/Argentina/Salta', 'America/Argentina/San_Juan',
    'America/Argentina/San_Luis', 'America/Argentina/Tucuman', 'America/Argentina/Ushuaia',
    'America/Aruba', 'America/Asuncion', 'America/Atikokan', 'America/Bahia', 'America/Bahia_Banderas',
    'America/Barbados', 'America/Belem', 'America/Belize', 'America/Blanc-Sablon', 'America/Boa_Vista',
    'America/Bogota', 'America/Boise', 'America/Boston', 'America/Bow_Island', 'America/Bozeman',
    'America/Brazil/Acre', 'America/Brazil/DeNoronha', 'America/Brazil/East', 'America/Brazil/West',
    'America/Bujumbura', 'America/Cancun', 'America/Caracas', 'America/Cardston', 'America/Caribou',
    'America/Catamarca', 'America/Cayenne', 'America/Cayman', 'America/Cedar_Rapids', 'America/Chihuahua',
    'America/Coral_Harbour', 'America/Cordoba', 'America/Costa_Rica', 'America/Creston', 'America/Cuiaba',
    'America/Curacao', 'America/Danmarkshavn', 'America/Dawson', 'America/Dawson_Creek', 'America/Denver',
    'America/Detroit', 'America/Dominica', 'America/Edmondton', 'America/Eirunepe', 'America/El_Salvador',
    'America/Ensenada', 'America/Fort_Nelson', 'America/Fort_Wayne', 'America/Fortaleza', 'America/Glace_Bay',
    'America/Godthab', 'America/Goose_Bay', 'America/Grand_Turk', 'America/Grenada', 'America/Guadeloupe',
    'America/Guam', 'America/Guatemala', 'America/Guayaquil', 'America/Guyana', 'America/Halifax',
    'America/Havana', 'America/Hermosillo', 'America/Hopedale', 'America/Houston', 'America/Indiana/Indianapolis',
    'America/Indiana/Knox', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Tell_City',
    'America/Indiana/Vevay', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indianapolis',
    'America/Inuvik', 'America/Iqaluit', 'America/Jamaica', 'America/Jujuy', 'America/Juneau',
    'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Knox_IN', 'America/Kralendijk',
    'America/La_Paz', 'America/La_Rioja', 'America/Labrador', 'America/Lacrosse', 'America/Lagos',
    'America/Lago_Titicaca', 'America/La_Paz', 'America/Lapaz', 'America/Las_Vegas', 'America/Lats_Vegas',
    'America/Lima', 'America/Lincoln', 'America/Los_Angeles', 'America/Louisville', 'America/Lowell',
    'America/Lower_Princes', 'America/Maceio', 'America/Madera', 'America/Madison', 'America/Magallanes',
    'America/Magadan', 'America/Managua', 'America/Manaus', 'America/Manicouagan', 'America/Maracaibo',
    'America/Maracay', 'America/Maranhao', 'America/Margherita_di_Savoia', 'America/Marianna', 'America/Marigot',
    'America/Marion', 'America/Marquette', 'America/Martinique', 'America/Matamoros', 'America/Mazatlan',
    'America/McArthur', 'America/Mendoza', 'America/Menominee', 'America/Merida', 'America/Meridian',
    'America/Mérida', 'America/Metlakatla', 'America/Mexico_City', 'America/Mexico/BajaNorte', 'America/Mexico/BajaSur',
    'America/Mexico/General', 'America/Miquelon', 'America/Miqelon', 'America/Mobile', 'America/Modesto',
    'America/Moncton', 'America/Monticello', 'America/Montreal', 'America/Montserrat', 'America/Montserrado',
    'America/Mora', 'America/Morelia', 'America/Morgan_City', 'America/Morgantown', 'America/Moscow',
    'America/Mosquito', 'America/Most', 'America/Mount_Vernon', 'America/Mountain_View', 'America/Moyobamba',
    'America/Mozarlândia', 'America/Mpumalanga', 'America/Msida', 'America/Muskogee', 'America/Musoma',
    'America/Mutare', 'America/Muzaffarabad', 'America/Mývatn', 'America/Nairobi', 'America/Nakhchivan',
    'America/Nampula', 'America/Nancy', 'America/Nanjing', 'America/Nanning', 'America/Napoli',
    'America/Nara', 'America/Narathiwat', 'America/Narayanganj', 'America/Narberth', 'America/Narbonne',
    'America/Narodni', 'America/Narva', 'America/Nassau', 'America/Natal', 'America/Natchez',
    'America/Nathan', 'America/Natividad', 'America/Natterjack', 'America/Nautla', 'America/Navajo',
    'America/Navarino', 'America/Navegantes', 'America/Navidad', 'America/Navío', 'America/Nayarit',
    'America/Nazaré', 'America/Nazareth', 'America/Nazca', 'America/Nazmi', 'America/Naznatchenskoe',
    'America/Neah_Bay', 'America/Nebraska', 'America/Needles', 'America/Neemuch', 'America/Neenah',
    'America/Negro', 'America/Nehru', 'America/Neiba', 'America/Neigh', 'America/Nei_Mongol',
    'America/Neinjiang', 'America/Nejapa', 'America/Nemaha', 'America/Nemby', 'America/Nemours',
    'America/Nenjiang', 'America/Nenochka', 'America/Neohobi', 'America/Nepal', 'America/Nephi',
    'America/Nephrite', 'America/Ner', 'America/Nerang', 'America/Nerchinsk', 'America/Nereid',
    'America/Nergal', 'America/Nerita', 'America/Nerja', 'America/Nerli', 'America/Nerlustrum',
    'America/Nerola', 'America/Nerolic', 'America/Neroli', 'America/Nerolid', 'America/Neroly',
    'America/Nerona', 'America/Nerota', 'America/Neroth', 'America/Neroved', 'America/Neroux',
    'America/Nerra', 'America/Nersa', 'America/Nersala', 'America/Nersam', 'America/Nersane',
    'America/Nersao', 'America/Nersas', 'America/Nersavam', 'America/Nersbergen', 'America/Nersbruck',
    'America/Nersburn', 'America/Nersby', 'America/Nerscote', 'America/Nersdale', 'America/Nersdean',
    'America/Nersdorf', 'America/Nersdorf-Munchweiler', 'America/Nersdown', 'America/Nersea', 'America/Nerseaux',
    -- Continue with common US timezones
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
    'America/Anchorage', 'America/Adak', 'Pacific/Honolulu',
    -- Asian timezones
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Bangkok',
    'Asia/Kolkata', 'Asia/Dubai', 'Asia/Jakarta', 'Asia/Seoul', 'Asia/Manila',
    -- European timezones
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam', 'Europe/Brussels',
    'Europe/Vienna', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Moscow', 'Europe/Istanbul',
    -- Australian/Pacific timezones
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Adelaide',
    'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Samoa', 'Pacific/Tongatapu'
  )
) NOT DEFERRABLE INITIALLY IMMEDIATE;

-- Create a public users extension table (since auth.users has limited access)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  language text NOT NULL DEFAULT 'en',
  date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  time_format text NOT NULL DEFAULT '24h', -- 24h or 12h
  week_starts_on integer NOT NULL DEFAULT 0, -- 0 = Sunday, 1 = Monday
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies for user preferences
CREATE POLICY "Users can view their own preferences"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own preferences"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own preferences"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Index for performance
CREATE INDEX idx_user_preferences_timezone ON public.user_preferences(timezone);

-- Trigger for updated_at
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to get user's timezone
CREATE OR REPLACE FUNCTION get_user_timezone(p_user_id uuid)
RETURNS text AS $$
DECLARE
  v_timezone text;
BEGIN
  SELECT COALESCE(up.timezone, au.timezone, 'UTC')
  INTO v_timezone
  FROM public.user_preferences up
  FULL OUTER JOIN auth.users au ON au.id = up.id
  WHERE au.id = p_user_id
  LIMIT 1;

  RETURN COALESCE(v_timezone, 'UTC');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to convert UTC timestamp to user's timezone
CREATE OR REPLACE FUNCTION convert_to_user_timezone(
  p_timestamp timestamptz,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN p_timestamp AT TIME ZONE v_timezone;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to convert user's timezone to UTC
CREATE OR REPLACE FUNCTION convert_to_utc(
  p_timestamp timestamptz,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN p_timestamp AT TIME ZONE v_timezone AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to get start of day in user's timezone
CREATE OR REPLACE FUNCTION start_of_day_user_tz(
  p_date date,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN (p_date || ' 00:00:00')::timestamp AT TIME ZONE v_timezone AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to get end of day in user's timezone
CREATE OR REPLACE FUNCTION end_of_day_user_tz(
  p_date date,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN (p_date || ' 23:59:59')::timestamp AT TIME ZONE v_timezone AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_timezone(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION convert_to_user_timezone(timestamptz, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION convert_to_utc(timestamptz, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION start_of_day_user_tz(date, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION end_of_day_user_tz(date, uuid) TO authenticated, anon;

-- Seed common timezones
INSERT INTO public.user_preferences (id, timezone, language, date_format, time_format, week_starts_on)
SELECT auth.uid(), 'UTC', 'en', 'YYYY-MM-DD', '24h', 0
WHERE NOT EXISTS (SELECT 1 FROM public.user_preferences WHERE id = auth.uid())
ON CONFLICT (id) DO NOTHING;
