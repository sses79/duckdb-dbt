select *
from {{ ref('int_wellbeing_submission_latest') }}
where operation = 'upsert'
