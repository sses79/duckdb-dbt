with answer_questions as (
    select distinct question_code, category
    from {{ ref('indicator_answer_catalog') }}
),
seed_questions as (
    select question_code, category_code, indicator_label, category_label, interpretation_note
    from {{ ref('indicator_catalog') }}
),
missing_from_seed as (
    select a.question_code, 'missing from indicator_catalog' as issue
    from answer_questions as a
    left join seed_questions as s
        on a.question_code = s.question_code
    where s.question_code is null
),
extra_in_seed as (
    select s.question_code, 'not in indicator_answer_catalog' as issue
    from seed_questions as s
    left join answer_questions as a
        on s.question_code = a.question_code
    where a.question_code is null
),
duplicated as (
    select question_code, 'duplicate question_code' as issue
    from seed_questions
    group by question_code
    having count(*) > 1
),
category_mismatch as (
    select s.question_code, 'category_code mismatch' as issue
    from seed_questions as s
    join answer_questions as a
        on s.question_code = a.question_code
    where s.category_code <> a.category
),
formula_characters as (
    select question_code, 'text starts with formula character' as issue
    from seed_questions
    where left(indicator_label, 1) in ('=', '+', '-', '@', chr(9), chr(13))
        or left(category_label, 1) in ('=', '+', '-', '@', chr(9), chr(13))
        or left(interpretation_note, 1) in ('=', '+', '-', '@', chr(9), chr(13))
)
select question_code, issue
from missing_from_seed
union all
select question_code, issue
from extra_in_seed
union all
select question_code, issue
from duplicated
union all
select question_code, issue
from category_mismatch
union all
select question_code, issue
from formula_characters
