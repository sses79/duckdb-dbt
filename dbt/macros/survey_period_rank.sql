{#- Rank survey periods written as YYYY-season, e.g. 2018-autumn. Parses the hyphen
   format produced by this repository; an underscore form (2018_autumn) would split on
   the wrong delimiter and silently mis-order. The rank is year * 10 plus a season rank:
   winter 1, spring 2, summer 3, autumn 4, and 5 for any other (unrecognised) season,
   so an unrecognised season sorts after every recognised season of its own year. -#}
{% macro survey_period_rank(column) -%}
    try_cast(split_part({{ column }}, '-', 1) as integer) * 10
    + case
        when lower(split_part({{ column }}, '-', 2)) = 'winter' then 1
        when lower(split_part({{ column }}, '-', 2)) = 'spring' then 2
        when lower(split_part({{ column }}, '-', 2)) = 'summer' then 3
        when lower(split_part({{ column }}, '-', 2)) = 'autumn' then 4
        else 5
      end
{%- endmacro %}
